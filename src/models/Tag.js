import mongoose from "mongoose";
import slugify from "slugify";

const { Schema, model } = mongoose;

const TagSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, index: true },
    slug: { type: String, required: true, unique: true, index: true },
    count: { type: Number, default: 0 }, // number of posts
  },
  { timestamps: true }
);

TagSchema.pre("validate", function (next) {
  if (this.name && !this.slug) this.slug = slugify(this.name, { lower: true, strict: true });
  next();
});

export default model("Tag", TagSchema);
